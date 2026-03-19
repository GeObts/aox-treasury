// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title AgentTreasury
 * @notice A treasury primitive where humans deposit wstETH principal,
 *         yield accrues, and AI agents can spend ONLY the yield — never the principal.
 * @author AOX (Agent Opportunity Exchange)
 * @dev Built for The Synthesis Ethereum Agent Hackathon 2026
 */
contract AgentTreasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============ State Variables ============
    
    /// @notice The wstETH token contract
    IERC20 public immutable wstETH;
    
    /// @notice The agent wallet authorized to withdraw yield
    address public agentWallet;
    
    /// @notice The principal amount deposited by owner (in wstETH)
    uint256 public principal;
    
    /// @notice The spending cap per transaction (in wstETH)
    uint256 public spendingCap;
    
    /// @notice Default spending cap: 0.005 wstETH (~$10-20 USDC at current prices, March 2026)
    uint256 public constant DEFAULT_SPENDING_CAP = 0.005 ether;
    
    /// @notice Minimum spending cap to prevent owner from locking agent out
    uint256 public constant MIN_SPENDING_CAP = 0.001 ether; // 0.001 wstETH minimum
    
    /// @notice Minimum yield threshold to prevent dust attacks
    uint256 public constant MIN_YIELD_THRESHOLD = 0.0001 ether; // ~0.2 USDC
    
    /// @notice Known wstETH address on Base mainnet
    address public constant WSTETH_BASE = 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452;

    // ============ Events ============
    
    event TreasuryDeployed(
        address indexed wstETH,
        address indexed owner,
        address indexed agent,
        uint256 spendingCap,
        uint256 timestamp
    );
    
    event Deposit(
        address indexed depositor,
        uint256 amount,
        uint256 newPrincipal,
        uint256 timestamp
    );
    
    event YieldWithdrawn(
        address indexed agent,
        uint256 amount,
        uint256 remainingYield,
        uint256 timestamp
    );
    
    event PrincipalWithdrawn(
        address indexed owner,
        uint256 amount,
        uint256 timestamp
    );
    
    event SpendingCapUpdated(
        uint256 oldCap,
        uint256 newCap,
        uint256 timestamp
    );
    
    event AgentWalletUpdated(
        address oldAgent,
        address newAgent,
        uint256 timestamp
    );
    
    event PrincipalReconciled(
        uint256 oldPrincipal,
        uint256 newPrincipal,
        uint256 timestamp
    );
    
    event UnexpectedDepositHandled(
        uint256 amount,
        uint256 newPrincipal,
        uint256 timestamp
    );
    
    event TokensRescued(
        address indexed token,
        uint256 amount,
        uint256 timestamp
    );

    // ============ Modifiers ============
    
    modifier onlyAgent() {
        require(msg.sender == agentWallet, "AgentTreasury: caller is not the agent");
        _;
    }
    
    // ============ Constructor ============
    
    /**
     * @notice Deploy the treasury
     * @param _wstETH The wstETH token address on Base (0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452)
     * @param _agentWallet The AI agent wallet authorized to spend yield
     * @param _owner The human owner who deposits principal (AOX CEO wallet)
     */
    constructor(
        address _wstETH,
        address _agentWallet,
        address _owner
    ) Ownable(_owner) {
        require(_wstETH != address(0), "AgentTreasury: wstETH address cannot be zero");
        require(_agentWallet != address(0), "AgentTreasury: agent wallet cannot be zero");
        require(_owner != address(0), "AgentTreasury: owner cannot be zero");
        
        // Validate that the provided address is the known wstETH on Base
        require(_wstETH == WSTETH_BASE, "AgentTreasury: must use Base wstETH");
        
        // Additional validation: check that it has a valid ERC20 interface
        require(IERC20(_wstETH).totalSupply() > 0, "AgentTreasury: invalid wstETH contract");
        
        wstETH = IERC20(_wstETH);
        agentWallet = _agentWallet;
        spendingCap = DEFAULT_SPENDING_CAP;
        
        emit TreasuryDeployed(_wstETH, _owner, _agentWallet, DEFAULT_SPENDING_CAP, block.timestamp);
        emit AgentWalletUpdated(address(0), _agentWallet, block.timestamp);
    }
    
    // ============ Deposit Functions ============
    
    /**
     * @notice Deposit wstETH as principal (only owner)
     * @param amount The amount of wstETH to deposit
     */
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "AgentTreasury: amount must be greater than 0");
        
        uint256 balanceBefore = wstETH.balanceOf(address(this));
        
        // Transfer wstETH from owner to this contract
        wstETH.safeTransferFrom(msg.sender, address(this), amount);
        
        uint256 balanceAfter = wstETH.balanceOf(address(this));
        uint256 actualReceived = balanceAfter - balanceBefore;
        
        require(actualReceived == amount, "AgentTreasury: transfer amount mismatch");
        
        // Increase principal tracking
        principal += actualReceived;
        
        emit Deposit(msg.sender, actualReceived, principal, block.timestamp);
    }
    
    /**
     * @notice Deposit wstETH with permit (gasless approval)
     * @param amount The amount of wstETH to deposit
     * @param deadline The permit deadline
     * @param v The permit signature v
     * @param r The permit signature r
     * @param s The permit signature s
     */
    function depositWithPermit(
        uint256 amount,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external onlyOwner nonReentrant {
        require(amount > 0, "AgentTreasury: amount must be greater than 0");
        require(block.timestamp <= deadline, "AgentTreasury: permit expired");
        
        uint256 allowanceBefore = IERC20(address(wstETH)).allowance(msg.sender, address(this));
        
        // Try permit - only catch specific expected errors
        try IERC20Permit(address(wstETH)).permit(
            msg.sender,
            address(this),
            amount,
            deadline,
            v,
            r,
            s
        ) {
            // Permit succeeded
        } catch Error(string memory reason) {
            // Only allow silent failure if it's "already approved" or similar
            // Reject invalid signatures, replays, etc.
            bytes32 alreadyApproved = keccak256(bytes("ERC20Permit: invalid signature"));
            bytes32 expired = keccak256(bytes("ERC20Permit: expired"));
            bytes32 invalidSigner = keccak256(bytes("ERC20Permit: invalid signer"));
            
            bytes32 actualReason = keccak256(bytes(reason));
            
            require(
                actualReason != alreadyApproved && 
                actualReason != expired && 
                actualReason != invalidSigner,
                string.concat("AgentTreasury: permit failed - ", reason)
            );
            
            // If not invalid signature/expired, check if already has sufficient allowance
            require(
                allowanceBefore >= amount,
                "AgentTreasury: permit failed and insufficient allowance"
            );
        } catch {
            // Unexpected error - check allowance
            require(
                IERC20(address(wstETH)).allowance(msg.sender, address(this)) >= amount,
                "AgentTreasury: permit failed and insufficient allowance"
            );
        }
        
        uint256 balanceBefore = wstETH.balanceOf(address(this));
        
        // Transfer wstETH from owner to this contract
        wstETH.safeTransferFrom(msg.sender, address(this), amount);
        
        uint256 balanceAfter = wstETH.balanceOf(address(this));
        uint256 actualReceived = balanceAfter - balanceBefore;
        
        require(actualReceived == amount, "AgentTreasury: transfer amount mismatch");
        
        // Increase principal tracking
        principal += actualReceived;
        
        emit Deposit(msg.sender, actualReceived, principal, block.timestamp);
    }
    
    /**
     * @notice Reconcile principal with actual balance
     * @dev Call this if someone sends wstETH directly to the contract
     *      Treats unexpected deposits as principal (owner's money)
     */
    function reconcilePrincipal() external onlyOwner {
        uint256 balance = wstETH.balanceOf(address(this));
        require(balance > principal, "AgentTreasury: no unexpected deposits to reconcile");
        
        uint256 oldPrincipal = principal;
        uint256 unexpectedAmount = balance - principal;
        
        principal = balance;
        
        emit PrincipalReconciled(oldPrincipal, principal, block.timestamp);
        emit UnexpectedDepositHandled(unexpectedAmount, principal, block.timestamp);
    }
    
    // ============ Agent Yield Spending ============
    
    /**
     * @notice Withdraw accrued yield (only agent, only yield, never principal)
     * @param amount The amount of yield to withdraw
     */
    function withdrawYield(uint256 amount) external onlyAgent nonReentrant {
        require(amount > 0, "AgentTreasury: amount must be greater than 0");
        require(amount <= spendingCap, "AgentTreasury: amount exceeds spending cap");
        
        uint256 availableYield = getAvailableYield();
        require(amount <= availableYield, "AgentTreasury: insufficient yield");
        
        // Transfer yield to agent
        wstETH.safeTransfer(agentWallet, amount);
        
        emit YieldWithdrawn(msg.sender, amount, availableYield - amount, block.timestamp);
    }
    
    // ============ Owner Principal Withdrawal ============
    
    /**
     * @notice Withdraw principal (only owner)
     * @param amount The amount of principal to withdraw
     */
    function withdrawPrincipal(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "AgentTreasury: amount must be greater than 0");
        require(amount <= principal, "AgentTreasury: insufficient principal");
        
        // Check actual balance to prevent withdrawing more than available
        uint256 balance = wstETH.balanceOf(address(this));
        require(balance >= amount, "AgentTreasury: insufficient contract balance");
        
        // Decrease principal tracking
        principal -= amount;
        
        // Transfer principal to owner
        wstETH.safeTransfer(owner(), amount);
        
        emit PrincipalWithdrawn(msg.sender, amount, block.timestamp);
    }
    
    /**
     * @notice Withdraw all principal (only owner)
     */
    function withdrawAllPrincipal() external onlyOwner nonReentrant {
        require(principal > 0, "AgentTreasury: no principal to withdraw");
        
        uint256 balance = wstETH.balanceOf(address(this));
        uint256 amount = principal;
        
        require(balance >= amount, "AgentTreasury: insufficient contract balance");
        
        principal = 0;
        
        wstETH.safeTransfer(owner(), amount);
        
        emit PrincipalWithdrawn(msg.sender, amount, block.timestamp);
    }
    
    // ============ View Functions ============
    
    /**
     * @notice Get the total wstETH balance of this contract
     * @return The total wstETH balance
     */
    function getTotalBalance() external view returns (uint256) {
        return wstETH.balanceOf(address(this));
    }
    
    /**
     * @notice Get the available yield (total balance minus principal)
     * @return The available yield
     */
    function getAvailableYield() public view returns (uint256) {
        uint256 totalBalance = wstETH.balanceOf(address(this));
        if (totalBalance <= principal) {
            return 0;
        }
        
        uint256 yield = totalBalance - principal;
        
        // Enforce minimum threshold to prevent dust attacks
        if (yield < MIN_YIELD_THRESHOLD) {
            return 0;
        }
        
        return yield;
    }
    
    /**
     * @notice Get the locked principal amount
     * @return The principal amount
     */
    function getPrincipal() external view returns (uint256) {
        return principal;
    }
    
    /**
     * @notice Check if there are unexpected deposits that need reconciliation
     * @return hasUnexpected True if balance exceeds principal
     * @return unexpectedAmount The amount of unexpected deposits
     */
    function checkUnexpectedDeposits() external view returns (bool hasUnexpected, uint256 unexpectedAmount) {
        uint256 balance = wstETH.balanceOf(address(this));
        if (balance > principal) {
            return (true, balance - principal);
        }
        return (false, 0);
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Update the spending cap (only owner)
     * @param newCap The new spending cap
     */
    function setSpendingCap(uint256 newCap) external onlyOwner {
        require(newCap >= MIN_SPENDING_CAP, "AgentTreasury: cap below minimum");
        
        uint256 oldCap = spendingCap;
        spendingCap = newCap;
        
        emit SpendingCapUpdated(oldCap, newCap, block.timestamp);
    }
    
    /**
     * @notice Update the agent wallet (only owner)
     * @param newAgentWallet The new agent wallet address
     */
    function setAgentWallet(address newAgentWallet) external onlyOwner {
        require(newAgentWallet != address(0), "AgentTreasury: agent wallet cannot be zero");
        require(newAgentWallet != address(this), "AgentTreasury: cannot be self");
        require(newAgentWallet != owner(), "AgentTreasury: cannot be owner");
        
        address oldAgent = agentWallet;
        agentWallet = newAgentWallet;
        
        emit AgentWalletUpdated(oldAgent, newAgentWallet, block.timestamp);
    }
    
    /**
     * @notice Emergency rescue tokens (only owner, for non-wstETH tokens)
     * @param token The token to rescue
     * @param amount The amount to rescue
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(wstETH), "AgentTreasury: cannot rescue wstETH");
        require(amount > 0, "AgentTreasury: amount must be greater than 0");
        IERC20(token).safeTransfer(owner(), amount);
        
        emit TokensRescued(token, amount, block.timestamp);
    }
    
    // ============ Receive Function ============
    
    receive() external payable {
        revert("AgentTreasury: do not send ETH directly");
    }
}
