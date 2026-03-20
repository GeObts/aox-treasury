// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title AgentTreasury
 * @notice Treasury contract for AOX agents to hold yield-bearing assets
 * @dev Designed for wstETH and other yield tokens on Base
 */
contract AgentTreasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // Events
    event Deposit(address indexed token, address indexed depositor, uint256 amount);
    event Withdrawal(address indexed token, address indexed recipient, uint256 amount);
    event YieldHarvested(address indexed token, uint256 amount);

    // Supported tokens (wstETH, USDC, etc.)
    mapping(address => bool) public supportedTokens;
    
    // Token balances per depositor
    mapping(address => mapping(address => uint256)) public balances;
    
    // Total token holdings
    mapping(address => uint256) public totalDeposits;

    // Constructor
    constructor(address _owner) Ownable(_owner) {
        // Owner is the deployer (Banker agent)
    }

    /**
     * @notice Add supported token
     * @param token Token address to support
     */
    function addSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = true;
    }

    /**
     * @notice Remove supported token
     * @param token Token address to remove
     */
    function removeSupportedToken(address token) external onlyOwner {
        supportedTokens[token] = false;
    }

    /**
     * @notice Deposit tokens into treasury
     * @param token Token to deposit
     * @param amount Amount to deposit
     */
    function deposit(address token, uint256 amount) external nonReentrant {
        require(supportedTokens[token], "Token not supported");
        require(amount > 0, "Amount must be > 0");
        
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        balances[token][msg.sender] += amount;
        totalDeposits[token] += amount;
        
        emit Deposit(token, msg.sender, amount);
    }

    /**
     * @notice Withdraw tokens from treasury
     * @param token Token to withdraw
     * @param amount Amount to withdraw
     */
    function withdraw(address token, uint256 amount) external nonReentrant {
        require(balances[token][msg.sender] >= amount, "Insufficient balance");
        
        balances[token][msg.sender] -= amount;
        totalDeposits[token] -= amount;
        
        IERC20(token).safeTransfer(msg.sender, amount);
        
        emit Withdrawal(token, msg.sender, amount);
    }

    /**
     * @notice Harvest yield - anyone can call to trigger yield accounting
     * @param token Token to check yield for
     */
    function harvestYield(address token) external {
        // For yield-bearing tokens like wstETH, the balance naturally grows
        // This function can be extended to distribute rewards or rebalance
        uint256 currentBalance = IERC20(token).balanceOf(address(this));
        uint256 yield = currentBalance > totalDeposits[token] ? currentBalance - totalDeposits[token] : 0;
        
        if (yield > 0) {
            emit YieldHarvested(token, yield);
        }
    }

    /**
     * @notice Emergency withdrawal by owner
     * @param token Token to withdraw
     * @param recipient Recipient address
     * @param amount Amount to withdraw
     */
    function emergencyWithdraw(address token, address recipient, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(recipient, amount);
    }

    /**
     * @notice Get balance of token for depositor
     */
    function getBalance(address token, address depositor) external view returns (uint256) {
        return balances[token][depositor];
    }

    /**
     * @notice Check if token is supported
     */
    function isSupported(address token) external view returns (bool) {
        return supportedTokens[token];
    }
}
