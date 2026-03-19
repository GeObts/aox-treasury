// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AgentTreasuryTestnet
 * @notice Testnet version of AgentTreasury - no hardcoded wstETH address check
 * @dev For Base Sepolia testing only
 */
contract AgentTreasuryTestnet is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable wstETH;
    address public agentWallet;
    uint256 public principal;
    uint256 public spendingCap;
    
    uint256 public constant DEFAULT_SPENDING_CAP = 0.005 ether;
    uint256 public constant MIN_SPENDING_CAP = 0.001 ether;
    uint256 public constant MIN_YIELD_THRESHOLD = 0.0001 ether;

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

    modifier onlyAgent() {
        require(msg.sender == agentWallet, "AgentTreasury: caller is not the agent");
        _;
    }
    
    constructor(
        address _wstETH,
        address _agentWallet,
        address _owner
    ) Ownable(_owner) {
        require(_wstETH != address(0), "AgentTreasury: wstETH address cannot be zero");
        require(_agentWallet != address(0), "AgentTreasury: agent wallet cannot be zero");
        require(_owner != address(0), "AgentTreasury: owner cannot be zero");
        
        wstETH = IERC20(_wstETH);
        agentWallet = _agentWallet;
        spendingCap = DEFAULT_SPENDING_CAP;
        
        emit TreasuryDeployed(_wstETH, _owner, _agentWallet, DEFAULT_SPENDING_CAP, block.timestamp);
        emit AgentWalletUpdated(address(0), _agentWallet, block.timestamp);
    }
    
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "AgentTreasury: amount must be greater than 0");
        
        uint256 balanceBefore = wstETH.balanceOf(address(this));
        wstETH.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = wstETH.balanceOf(address(this));
        uint256 actualReceived = balanceAfter - balanceBefore;
        
        require(actualReceived == amount, "AgentTreasury: transfer amount mismatch");
        principal += actualReceived;
        
        emit Deposit(msg.sender, actualReceived, principal, block.timestamp);
    }
    
    function reconcilePrincipal() external onlyOwner {
        uint256 balance = wstETH.balanceOf(address(this));
        require(balance > principal, "AgentTreasury: no unexpected deposits to reconcile");
        
        uint256 oldPrincipal = principal;
        uint256 unexpectedAmount = balance - principal;
        principal = balance;
        
        emit PrincipalReconciled(oldPrincipal, principal, block.timestamp);
        emit UnexpectedDepositHandled(unexpectedAmount, principal, block.timestamp);
    }
    
    function withdrawYield(uint256 amount) external onlyAgent nonReentrant {
        require(amount > 0, "AgentTreasury: amount must be greater than 0");
        require(amount <= spendingCap, "AgentTreasury: amount exceeds spending cap");
        
        uint256 availableYield = getAvailableYield();
        require(amount <= availableYield, "AgentTreasury: insufficient yield");
        
        wstETH.safeTransfer(agentWallet, amount);
        emit YieldWithdrawn(msg.sender, amount, availableYield - amount, block.timestamp);
    }
    
    function withdrawPrincipal(uint256 amount) external onlyOwner nonReentrant {
        require(amount > 0, "AgentTreasury: amount must be greater than 0");
        require(amount <= principal, "AgentTreasury: insufficient principal");
        
        uint256 balance = wstETH.balanceOf(address(this));
        require(balance >= amount, "AgentTreasury: insufficient contract balance");
        
        principal -= amount;
        wstETH.safeTransfer(owner(), amount);
        
        emit PrincipalWithdrawn(msg.sender, amount, block.timestamp);
    }
    
    function withdrawAllPrincipal() external onlyOwner nonReentrant {
        require(principal > 0, "AgentTreasury: no principal to withdraw");
        
        uint256 balance = wstETH.balanceOf(address(this));
        uint256 amount = principal;
        
        require(balance >= amount, "AgentTreasury: insufficient contract balance");
        
        principal = 0;
        wstETH.safeTransfer(owner(), amount);
        
        emit PrincipalWithdrawn(msg.sender, amount, block.timestamp);
    }
    
    function getTotalBalance() external view returns (uint256) {
        return wstETH.balanceOf(address(this));
    }
    
    function getAvailableYield() public view returns (uint256) {
        uint256 totalBalance = wstETH.balanceOf(address(this));
        if (totalBalance <= principal) {
            return 0;
        }
        
        uint256 yield = totalBalance - principal;
        if (yield < MIN_YIELD_THRESHOLD) {
            return 0;
        }
        
        return yield;
    }
    
    function getPrincipal() external view returns (uint256) {
        return principal;
    }
    
    function checkUnexpectedDeposits() external view returns (bool hasUnexpected, uint256 unexpectedAmount) {
        uint256 balance = wstETH.balanceOf(address(this));
        if (balance > principal) {
            return (true, balance - principal);
        }
        return (false, 0);
    }
    
    function setSpendingCap(uint256 newCap) external onlyOwner {
        require(newCap >= MIN_SPENDING_CAP, "AgentTreasury: cap below minimum");
        
        uint256 oldCap = spendingCap;
        spendingCap = newCap;
        
        emit SpendingCapUpdated(oldCap, newCap, block.timestamp);
    }
    
    function setAgentWallet(address newAgentWallet) external onlyOwner {
        require(newAgentWallet != address(0), "AgentTreasury: agent wallet cannot be zero");
        require(newAgentWallet != address(this), "AgentTreasury: cannot be self");
        require(newAgentWallet != owner(), "AgentTreasury: cannot be owner");
        
        address oldAgent = agentWallet;
        agentWallet = newAgentWallet;
        
        emit AgentWalletUpdated(oldAgent, newAgentWallet, block.timestamp);
    }
    
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(wstETH), "AgentTreasury: cannot rescue wstETH");
        require(amount > 0, "AgentTreasury: amount must be greater than 0");
        IERC20(token).safeTransfer(owner(), amount);
        
        emit TokensRescued(token, amount, block.timestamp);
    }
    
    receive() external payable {
        revert("AgentTreasury: do not send ETH directly");
    }
}
