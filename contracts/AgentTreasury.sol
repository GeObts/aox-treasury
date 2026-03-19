// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
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
    
    /// @notice The spending cap per transaction (in wstETH, roughly equivalent to 10 USDC)
    uint256 public spendingCap;
    
    /// @notice Default spending cap: ~10 USDC worth (using 0.005 wstETH as proxy)
    uint256 public constant DEFAULT_SPENDING_CAP = 0.005 ether;
    
    /// @notice Precision for yield calculations
    uint256 public constant PRECISION = 1e18;
    
    // ============ Events ============
    
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
        
        wstETH = IERC20(_wstETH);
        agentWallet = _agentWallet;
        spendingCap = DEFAULT_SPENDING_CAP;
        
        emit AgentWalletUpdated(address(0), _agentWallet, block.timestamp);
    }
    
    // ============ Deposit Functions ============
    
    /**
     * @notice Deposit wstETH as principal (only owner)
     * @param amount The amount of wstETH to deposit
     */
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "AgentTreasury: amount must be greater than 0");
        
        // Transfer wstETH from owner to this contract
        wstETH.safeTransferFrom(msg.sender, address(this), amount);
        
        // Increase principal tracking
        principal += amount;
        
        emit Deposit(msg.sender, amount, principal, block.timestamp);
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
        
        // Use permit for gasless approval
        try IERC20Permit(address(wstETH)).permit(
            msg.sender,
            address(this),
            amount,
            deadline,
            v,
            r,
            s
        ) {} catch {
            // Permit may fail if already approved, continue anyway
        }
        
        // Transfer wstETH from owner to this contract
        wstETH.safeTransferFrom(msg.sender, address(this), amount);
        
        // Increase principal tracking
        principal += amount;
        
        emit Deposit(msg.sender, amount, principal, block.timestamp);
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
        
        uint256 amount = principal;
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
        return totalBalance - principal;
    }
    
    /**
     * @notice Get the locked principal amount
     * @return The principal amount
     */
    function getPrincipal() external view returns (uint256) {
        return principal;
    }
    
    // ============ Admin Functions ============
    
    /**
     * @notice Update the spending cap (only owner)
     * @param newCap The new spending cap
     */
    function setSpendingCap(uint256 newCap) external onlyOwner {
        require(newCap > 0, "AgentTreasury: cap must be greater than 0");
        
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
        IERC20(token).safeTransfer(owner(), amount);
    }
    
    // ============ Receive Function ============
    
    receive() external payable {
        revert("AgentTreasury: do not send ETH directly");
    }
}

// Minimal interface for permit functionality
interface IERC20Permit {
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}
